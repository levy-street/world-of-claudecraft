// The DERIVED aura-track catalog (src/ui/hud/aura_tracks/aura_track_catalog.ts).
//
// WHAT THIS FILE REFUSES TO BE. It is not a copy of the catalog's output. A pin
// that listed all sixty-odd derived ids would go green on any rule change that
// happened to produce the same list, and red on every new spell, which turns the
// gate into a chore people update without reading. The membership rules are what
// carry meaning, so those are what is asserted: the duration ceiling, the
// defensive cooldown line, each kind set, the by-id exclusions, and the two
// contracts the catalog shares with the rest of the game: its keys are the ids
// the SIM applies (proven by casting through a real Sim), and its modes are the
// ones the aura STRIPS call modes (proven against isToggleAuraKind).
//
// The exception is a short list of LOAD-BEARING spells pinned by id. Those are
// the ones a player would call the feature broken without (a mage's Ice Block, a
// rogue's Sprint, a priest's Shield, a druid's Rejuvenation), and each was
// missing at some point while the rules were being written, which is exactly why
// naming them is worth the maintenance.

import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { AbilityDef, AuraKind, PlayerClass } from '../src/sim/types';
import { isToggleAuraKind } from '../src/ui/auras_view';
import {
  AURA_TRACK_CATALOG,
  AURA_TRACK_DURATION_CEILING_SEC,
  type AuraTrackEntry,
  auraTrackEntry,
  DEFENSIVE_COOLDOWN_SEC,
} from '../src/ui/hud/aura_tracks/aura_track_catalog';
import { AURA_TRACKS } from '../src/ui/hud/aura_tracks/aura_track_descriptors';
import { EMPTY_TEST_WORLD } from './sim_shared';

const abilities = ABILITIES as Record<string, AbilityDef>;

describe('aura track catalog: what it derives', () => {
  it('is built from the ability table and is neither empty nor everything', () => {
    // The floor and the ceiling together are the proof that the derivation ran
    // and still discriminates: a rule that admitted everything would sail past a
    // "greater than zero" check, and a rule that admitted nothing past a
    // "less than all" one.
    expect(AURA_TRACK_CATALOG.size).toBeGreaterThan(40);
    expect(AURA_TRACK_CATALOG.size).toBeLessThan(Object.keys(abilities).length / 3);
    for (const [key, entry] of AURA_TRACK_CATALOG) {
      expect(entry.id).toBe(key);
      expect(abilities[entry.abilityId], `${entry.id} names no ability`).toBeDefined();
    }
  });

  it('admits nothing longer than the duration ceiling except a mode', () => {
    // The whole reason the long buffs stay out. Everything timed is 60s or less;
    // a mode (stealth, travel form) carries a long duration purely so nothing
    // can expire it, so it is admitted past the ceiling and drawn without a
    // countdown. The mode exemption is decided by the shared classifier in the
    // next test, not by the catalog's own label, so this cannot be satisfied by
    // calling a long buff a mode.
    for (const entry of AURA_TRACK_CATALOG.values()) {
      if (entry.shape === 'mode') continue;
      expect(
        entry.duration,
        `${entry.id} is timed but its aura runs ${entry.duration}s`,
      ).toBeLessThanOrEqual(AURA_TRACK_DURATION_CEILING_SEC);
    }
  });

  it('calls a row a mode exactly when the aura strips do', () => {
    // ONE toggle classifier. An earlier cut admitted any long utility-kind aura
    // as a mode by its own rule, while the view drew rows by the strips' rule:
    // the hunter aspects (buff_speed, 1800s) came in as "modes" and were painted
    // as 1,800s countdowns, and Vanish (10s, kind stealth) was labelled a timer
    // and painted as a mode. Now the catalog asks the same question the painter
    // will, so the two cannot disagree.
    for (const entry of AURA_TRACK_CATALOG.values()) {
      expect(entry.shape === 'mode', `${entry.id} (${entry.kind})`).toBe(
        isToggleAuraKind(entry.id, entry.kind as AuraKind),
      );
    }
    for (const id of ['stealth', 'prowl', 'travel_form', 'ghost_wolf', 'vanish']) {
      if (!abilities[id]) continue;
      expect(auraTrackEntry(id)?.shape, `${id} is a toggle for the strips`).toBe('mode');
    }
  });

  it('leaves the long buffs out, by name', () => {
    // The next longest helpful buffs in the game: the 600s wards, the 1800s raid
    // buffs, aspects, poisons and imbues, the 3600s forms and stances. The
    // ceiling sits in a 10x gap, so these are not borderline cases; if one of
    // them ever shows up here, a rule moved and this is the file that says so.
    // The three speed buffs are the ones the first cut let through as "modes".
    for (const id of [
      'thunder_ward',
      'briarguard',
      'battle_shout',
      'arcane_intellect',
      'aspect_of_the_cheetah',
      'pack_rally',
      'sacrilegious_march',
    ]) {
      if (!abilities[id]) continue;
      expect(auraTrackEntry(id), `${id} is a long buff and must not be tracked`).toBeUndefined();
    }
  });

  it('splits guard entries at the defensive cooldown line with a real gap', () => {
    // The Defensives / Self split is a cooldown threshold, and it is only
    // meaningful because the data leaves room around it. Assert the GAP rather
    // than the constant: if content ever lands a 55s defensive, the line stops
    // being a clean one and this fails while the constant still "matches".
    const guards = [...AURA_TRACK_CATALOG.values()].filter((e) => e.category === 'guard');
    const emergency = guards.filter((e) => e.cooldown >= DEFENSIVE_COOLDOWN_SEC);
    const rotational = guards.filter((e) => e.cooldown < DEFENSIVE_COOLDOWN_SEC);
    expect(emergency.length).toBeGreaterThan(4);
    expect(rotational.length).toBeGreaterThan(2);
    const longestRotational = Math.max(...rotational.map((e) => e.cooldown));
    expect(longestRotational).toBeLessThan(DEFENSIVE_COOLDOWN_SEC);
  });

  it('gives an absorb a points row and everything else a timer or a mode', () => {
    // The shape is what the painter branches on, and it is fully determined by
    // the category: an absorb spends POINTS (the sim stores the remaining shield
    // in the aura's value), a toggle has no clock, everything else is a timer.
    for (const entry of AURA_TRACK_CATALOG.values()) {
      if (entry.category === 'absorb') expect(entry.shape).toBe('points');
      else expect(entry.shape === 'timer' || entry.shape === 'mode').toBe(true);
      if (entry.shape === 'mode') expect(entry.category).toBe('utility');
    }
  });

  it('tracks the spells a player would call the feature broken without', () => {
    // Each of these was absent at some point while the kind sets were being
    // written, and none of the rule-shaped assertions above would have noticed.
    const expected: ReadonlyArray<readonly [string, string]> = [
      // The mage immunity. Its `stasis` kind belongs to no stat family, so it
      // fell through every set until it was named.
      ['ice_block', 'guard'],
      ['evasion', 'guard'],
      ['barkskin', 'guard'],
      ['die_by_sword', 'guard'],
      ['sacred_bulwark', 'guard'],
      ['rejuvenation', 'hot'],
      ['renew', 'hot'],
      ['power_word_shield', 'absorb'],
      ['ice_barrier', 'absorb'],
      ['sprint', 'utility'],
      ['stealth', 'utility'],
      ['travel_form', 'utility'],
      ['solar_step', 'utility'],
      ['blade_flurry', 'power'],
      ['icy_veins', 'power'],
      ['recklessness', 'power'],
    ];
    for (const [id, category] of expected) {
      const entry = auraTrackEntry(id);
      expect(entry, `${id} is no longer tracked at all`).toBeDefined();
      expect(entry?.category, `${id} changed category`).toBe(category);
    }
  });

  it('keys every entry by the aura id the sim applies, not by the ability id', () => {
    // The miss a derived catalog exists to prevent, found in review: an effect
    // can name its own auraId, a second self-buff is kind-suffixed, and an
    // absorb beside a stasis takes _absorb. A catalog keyed by ability id had
    // rows for raised_guard and whirlwind that no live aura could ever match,
    // and no row at all for Hallowed Wall's shield.
    const byAuraId: ReadonlyArray<readonly [string, string, string]> = [
      ['raised_guard_dr', 'raised_guard', 'guard'],
      ['bladed_echo', 'whirlwind', 'power'],
      ['holy_shield', 'holy_shield', 'guard'],
      ['holy_shield_absorb', 'holy_shield', 'absorb'],
      ['arcane_power', 'arcane_power', 'power'],
      ['arcane_power_buff_spellhaste', 'arcane_power', 'power'],
    ];
    for (const [auraId, abilityId, category] of byAuraId) {
      const entry = auraTrackEntry(auraId);
      expect(entry, `${auraId} is not tracked`).toBeDefined();
      expect(entry?.abilityId).toBe(abilityId);
      expect(entry?.category).toBe(category);
    }
    // The ability-id ghosts: an entry here would be a row no aura can fill.
    for (const ghost of ['raised_guard', 'whirlwind']) {
      expect(auraTrackEntry(ghost), `${ghost} is an ability id, not an aura id`).toBeUndefined();
    }
  });

  it('resolves every helpful aura a real cast leaves, under the id the sim gave it', () => {
    // The catalog and the dispatcher share src/sim/combat/aura_ids.ts; this is
    // what proves they still do. Each class casts one ability that exercises a
    // different id rule (an explicit auraId, a stasis-free absorb beside a
    // self-buff, a kind-suffixed companion, a plain primary) and every aura the
    // cast puts on the player must have a catalog row keyed by its live id.
    // Raised Guard and Hallowed Wall are Protection abilities, so those two
    // casts pick the spec first; the rest are baseline spells of their class.
    const casts: ReadonlyArray<readonly [PlayerClass, string | null, string, readonly string[]]> = [
      ['warrior', 'prot', 'raised_guard', ['raised_guard_dr']],
      ['paladin', 'protection', 'holy_shield', ['holy_shield', 'holy_shield_absorb']],
      ['paladin', null, 'avenging_wrath', ['avenging_wrath', 'avenging_wrath_buff_healing_done']],
      ['priest', null, 'power_word_shield', ['power_word_shield']],
      ['druid', null, 'barkskin', ['barkskin']],
    ];
    for (const [playerClass, spec, abilityId, expectedIds] of casts) {
      const sim = new Sim({ seed: 7, playerClass, autoEquip: true, world: EMPTY_TEST_WORLD });
      sim.setPlayerLevel(60);
      if (spec) expect(sim.setSpec(spec), `${playerClass} could not pick ${spec}`).toBe(true);
      sim.player.resource = sim.player.maxResource;
      const eventsBefore = sim.events.length;
      sim.castAbility(abilityId);
      for (let i = 0; i < 5; i++) sim.tick();
      const refused = sim.events
        .slice(eventsBefore)
        .filter((e) => e.type === 'error')
        .map((e) => ('text' in e ? e.text : ''));
      expect(refused, `${playerClass} ${abilityId} was refused`).toEqual([]);
      const live = sim.player.auras.filter((a) => a.sourceId === sim.player.id).map((a) => a.id);
      for (const id of expectedIds) {
        expect(live, `${playerClass} ${abilityId} did not apply ${id}`).toContain(id);
        expect(auraTrackEntry(id), `${id} is live but has no catalog row`).toBeDefined();
      }
    }
  });

  it('honours its by-id exclusions, each of which has a live ability behind it', () => {
    // An exclusion for a spell that no longer exists is a rule protecting
    // nothing, and reads as coverage it is not providing.
    for (const id of ['devotion_ward', 'ghostly_strike', 'scorch']) {
      expect(abilities[id], `${id} is excluded but no such ability exists`).toBeDefined();
      expect(auraTrackEntry(id), `${id} is excluded and must not be tracked`).toBeUndefined();
    }
  });

  it('leaves the next-cast family out, so no bar counts down something inert', () => {
    // Inner Focus and Cold Blood change the NEXT thing you press rather than
    // your current state; a bar counting one down says nothing about what is
    // happening to you. They are excluded BY KIND (no set holds `cast_shield` or
    // `next_attack_crit`), which is why there is no by-id row for them.
    for (const id of ['inner_focus', 'cold_blood']) {
      if (!abilities[id]) continue;
      expect(auraTrackEntry(id), `${id} is a next-cast modifier and must not be tracked`).toBe(
        undefined,
      );
    }
  });
});

describe('aura track catalog: how the six tracks partition it', () => {
  it('gives every entry at least one home', () => {
    // A derived entry no track accepts is dead weight that reads like coverage:
    // the catalog says the spell is tracked and no bar would ever show it.
    for (const entry of AURA_TRACK_CATALOG.values()) {
      const homes = AURA_TRACKS.filter(
        (t) => t.accepts(entry, true) || t.accepts(entry, false),
      ).map((t) => t.id);
      expect(homes.length, `${entry.id} belongs to no track`).toBeGreaterThan(0);
    }
  });

  it('keeps Defensives and Self disjoint, and splits them on the cooldown', () => {
    // Same category, same side, one threshold: an entry in both would show the
    // same countdown in two frames at once.
    const defensives = AURA_TRACKS.find((t) => t.id === 'defensives');
    const self = AURA_TRACKS.find((t) => t.id === 'self');
    expect(defensives && self).toBeTruthy();
    if (!defensives || !self) return;
    for (const entry of AURA_TRACK_CATALOG.values()) {
      expect(
        defensives.accepts(entry, true) && self.accepts(entry, true),
        `${entry.id} is in both Defensives and Self`,
      ).toBe(false);
    }
    expect(defensives.accepts({ ...guard(), cooldown: DEFENSIVE_COOLDOWN_SEC }, true)).toBe(true);
    expect(defensives.accepts({ ...guard(), cooldown: DEFENSIVE_COOLDOWN_SEC - 1 }, true)).toBe(
      false,
    );
    expect(self.accepts({ ...guard(), cooldown: DEFENSIVE_COOLDOWN_SEC - 1 }, true)).toBe(true);
    expect(self.accepts({ ...guard(), cooldown: DEFENSIVE_COOLDOWN_SEC }, true)).toBe(false);
  });

  it('decides the protective tracks by WHERE the aura landed, not by the ability', () => {
    // The bug this replaced: the predicates read the ability's scope, which let
    // a self-only buff be accepted onto an ally row and dropped a pet heal the
    // content marks `requiresTarget: false` out of the ally track entirely.
    const defensives = AURA_TRACKS.find((t) => t.id === 'defensives');
    const self = AURA_TRACKS.find((t) => t.id === 'self');
    const friendly = AURA_TRACKS.find((t) => t.id === 'friendly');
    expect(defensives && self && friendly).toBeTruthy();
    if (!defensives || !self || !friendly) return;
    const hot: AuraTrackEntry = {
      id: 'x',
      abilityId: 'x',
      kind: 'hot',
      duration: 12,
      category: 'hot',
      shape: 'timer',
      cooldown: 0,
    };
    expect(self.accepts(hot, true)).toBe(true);
    expect(self.accepts(hot, false)).toBe(false);
    expect(friendly.accepts(hot, false)).toBe(true);
    expect(friendly.accepts(hot, true)).toBe(false);
    expect(defensives.accepts({ ...guard(), cooldown: 300 }, false)).toBe(false);

    // A pet heal reaches the friendly track on the strength of `onSelf` alone.
    const mendPet = auraTrackEntry('mend_pet');
    expect(mendPet).toBeDefined();
    if (mendPet) expect(friendly.accepts(mendPet, false)).toBe(true);
  });

  it('puts Guardian Covenant in the self AND the friendly track', () => {
    // One cast, two auras. Either can be dispelled without the other, so a
    // single row would keep showing a protection that is already gone.
    const covenant = auraTrackEntry('guardian_covenant');
    expect(covenant, 'guardian_covenant is no longer tracked').toBeDefined();
    if (!covenant) return;
    const self = AURA_TRACKS.find((t) => t.id === 'self');
    const friendly = AURA_TRACKS.find((t) => t.id === 'friendly');
    expect(self?.accepts(covenant, true)).toBe(true);
    expect(friendly?.accepts(covenant, false)).toBe(true);
  });

  it('sends every absorb to Shields and nothing else there', () => {
    const shields = AURA_TRACKS.find((t) => t.id === 'shields');
    expect(shields).toBeDefined();
    if (!shields) return;
    for (const entry of AURA_TRACK_CATALOG.values()) {
      expect(shields.accepts(entry, true), `${entry.id}`).toBe(entry.category === 'absorb');
    }
    expect(shields.shape).toBe('points');
  });

  it('gives each track a unique id, element, storage key and setting', () => {
    // A duplicated storage key would make two frames overwrite each other's
    // saved box, which is silent until a reload.
    const fields = ['id', 'elementId', 'storageKey', 'settingKey', 'labelKey'] as const;
    for (const field of fields) {
      const values = AURA_TRACKS.map((t) => t[field]);
      expect(new Set(values).size, `duplicate ${field}`).toBe(AURA_TRACKS.length);
    }
    expect(AURA_TRACKS).toHaveLength(6);
  });
});

/** A minimal guard entry the threshold assertions vary one field of. */
function guard(): AuraTrackEntry {
  return {
    id: 'g',
    abilityId: 'g',
    kind: 'buff_dr',
    duration: 10,
    category: 'guard',
    shape: 'timer',
    cooldown: 0,
  };
}
