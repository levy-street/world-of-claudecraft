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
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { AbilityDef, AuraKind, Entity, PlayerClass } from '../src/sim/types';
import { isToggleAuraKind } from '../src/ui/auras_view';
import {
  AURA_TRACK_CATALOG,
  AURA_TRACK_DURATION_CEILING_SEC,
  type AuraTrackCategory,
  type AuraTrackEntry,
  auraTrackEntry,
  DEFENSIVE_COOLDOWN_SEC,
} from '../src/ui/hud/aura_tracks/aura_track_catalog';
import { AURA_TRACKS } from '../src/ui/hud/aura_tracks/aura_track_descriptors';
import { createAuraTrackView } from '../src/ui/hud/aura_tracks/aura_track_view';
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
      // Chronomancy's ally mark. The content models it with its own effect type
      // rather than `hot` (an echo converts the mage's Arcane damage into healing
      // instead of ticking a stored total), which is exactly how it fell out of
      // every track while Wildbloom and Renew sailed through.
      ['temporal_echo', 'hot'],
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

  it('shows a real ally-targeted maintained heal as a Friendly row, whatever effect type it uses', () => {
    // THE GAP THIS FILE HAD. Every cast in the test above targets the CASTER, so
    // a spell that only ever lands on somebody else was never exercised at all,
    // and the friendly track is the one whose whole point is somebody else.
    // Chronomancy's Temporal Echo went missing from all six tracks that way: the
    // content models the mark with its own effect type (an echo converts the
    // mage's Arcane damage into healing on the marked ally rather than ticking a
    // stored total), so the `type === 'hot'` rule never saw it, while Wildbloom
    // sailed through. Wildbloom is the control arm here for exactly that reason:
    // a run where only the mage arm fails is the player report ("the druid's
    // shows up and the chronomancer's does not") reproduced.
    //
    // It drives the REAL selection core over the REAL post-cast entities rather
    // than stopping at the catalog, because a catalog row nothing paints is the
    // same bug wearing a green test.
    const friendly = AURA_TRACKS.find((t) => t.id === 'friendly');
    expect(friendly).toBeDefined();
    if (!friendly) return;
    const casts: ReadonlyArray<readonly [PlayerClass, string | null, string, string]> = [
      ['druid', null, 'rejuvenation', 'rejuvenation'],
      ['mage', 'arcane', 'temporal_echo', 'temporal_echo'],
    ];
    for (const [playerClass, spec, abilityId, auraId] of casts) {
      const sim = new Sim({ seed: 11, playerClass, autoEquip: true, world: EMPTY_TEST_WORLD });
      sim.setPlayerLevel(20);
      if (spec) expect(sim.setSpec(spec), `${playerClass} could not pick ${spec}`).toBe(true);
      const player = sim.player;
      player.resource = player.maxResource;
      const allyId = sim.addPlayer('warrior', 'Ally');
      const ally = sim.entities.get(allyId);
      expect(ally, 'the ally never joined the world').toBeDefined();
      if (!ally) continue;
      ally.pos = { ...player.pos };
      ally.pos.x += 2; // well inside the 30 yd friendly cast range
      ally.prevPos = { ...ally.pos };
      const eventsBefore = sim.events.length;
      sim.targetEntity(allyId);
      sim.castAbility(abilityId);
      for (let i = 0; i < 5; i++) sim.tick();
      const refused = sim.events
        .slice(eventsBefore)
        .filter((e) => e.type === 'error')
        .map((e) => ('text' in e ? e.text : ''));
      expect(refused, `${playerClass} ${abilityId} was refused`).toEqual([]);

      const live = ally.auras.find((a) => a.id === auraId && a.sourceId === player.id);
      expect(live, `${abilityId} left no ${auraId} on the ally`).toBeDefined();
      const entry = auraTrackEntry(auraId);
      expect(entry, `${auraId} is live on an ally but has no catalog row`).toBeDefined();
      if (!entry) continue;
      expect(friendly.accepts(entry, false), `${auraId} is not accepted by Friendly`).toBe(true);

      const view = createAuraTrackView(friendly, {
        isOwn: (a) => a.sourceId === player.id,
        isMode: () => false,
        auraName: (a) => a.name,
        unitName: (e) => e.name,
        iconKey: (a) => a.id,
      });
      const state = view.tick({
        player,
        allies: sim.entities.values(),
        enabled: true,
        includeModes: true,
      });
      const rows = state.rows.slice(0, state.count).map((r) => `${r.key}|${r.unitName}`);
      expect(rows, `${abilityId} paints no Friendly row for the ally it marked`).toContain(
        `${allyId}:${auraId}|${ally.name}`,
      );
    }
  });

  it('tracks the beneficial Hourglass of Suspension without ever tracking its hostile arm', () => {
    // Hourglass of Suspension is the second half of the same miss: another
    // bespoke effect type (`temporalHourglass`), so the `stasis` kind that puts
    // Cold Coffin in a track was never reached and the mage healer's one
    // immunity button showed nowhere.
    //
    // AND IT CARRIES A TRAP THE OTHER SPELLS DO NOT. One cast applies the SAME
    // aura id with two opposite meanings: `stasis` on the caster or a group ally
    // (helpful, what this family is for) and `incapacitate` on an enemy
    // (harmful, which belongs to the enemy-side family in src/ui/hud/target_dots/).
    // The catalog is keyed by aura id alone, so admitting the id without a
    // polarity guard would put "Hourglass of Suspension on Forest Wolf" in the
    // FRIENDLY track, which reads as a heal the mage is maintaining on a mob.
    // Both arms are asserted here; the hostile one is the whole point.
    const FLAT_X = 700;
    const rig = () => {
      const sim = new Sim({ seed: 147, playerClass: 'mage', world: EMPTY_TEST_WORLD });
      sim.setPlayerLevel(14);
      expect(sim.setSpec('arcane'), 'mage could not pick arcane').toBe(true);
      sim.tick();
      const mage = sim.player;
      mage.pos = sim.groundPos(FLAT_X, 0);
      mage.prevPos = { ...mage.pos };
      const host = sim as unknown as { rebucket(e: Entity): void };
      host.rebucket(mage);
      return { sim, mage };
    };
    const rowsFor = (sim: Sim, mage: Entity, trackId: string): string[] => {
      const descriptor = AURA_TRACKS.find((t) => t.id === trackId);
      expect(descriptor, `no such track: ${trackId}`).toBeDefined();
      if (!descriptor) return [];
      const view = createAuraTrackView(descriptor, {
        isOwn: (a) => a.sourceId === mage.id,
        isMode: () => false,
        auraName: (a) => a.name,
        unitName: (e) => e.name,
        iconKey: (a) => a.id,
      });
      const state = view.tick({
        player: mage,
        allies: sim.entities.values(),
        enabled: true,
        includeModes: true,
      });
      return state.rows.slice(0, state.count).map((r) => r.key);
    };
    const cast = (sim: Sim, mage: Entity, x: number) => {
      mage.gcdRemaining = 0;
      mage.resource = mage.maxResource;
      mage.cooldowns.delete('temporal_hourglass');
      sim.castAbility('temporal_hourglass', mage.id, { x, z: 0 });
      for (let i = 0; i < 3; i++) sim.tick();
    };

    // The helpful arm, on a group ally: a Friendly row, exactly like a HoT.
    {
      const { sim, mage } = rig();
      const allyId = sim.addPlayer('warrior', 'Ally');
      const ally = sim.entities.get(allyId);
      expect(ally, 'the ally never joined the world').toBeDefined();
      if (!ally) return;
      ally.pos = sim.groundPos(FLAT_X + 8, 0);
      ally.prevPos = { ...ally.pos };
      (sim as unknown as { rebucket(e: Entity): void }).rebucket(ally);
      sim.partyInvite(allyId, mage.id);
      sim.partyAccept(allyId);
      cast(sim, mage, ally.pos.x);
      const live = ally.auras.find((a) => a.id === 'temporal_hourglass');
      expect(live?.kind, 'the ally did not receive the stasis arm').toBe('stasis');
      const entry = auraTrackEntry('temporal_hourglass');
      expect(entry, 'temporal_hourglass is live but has no catalog row').toBeDefined();
      expect(entry?.category, 'the hourglass stasis is protection, like Cold Coffin').toBe('guard');
      expect(rowsFor(sim, mage, 'friendly')).toContain(`${allyId}:temporal_hourglass`);
    }

    // The hostile arm, on a mob: no row, in ANY of the six.
    {
      const { sim, mage } = rig();
      const host = sim as unknown as { nextId: number; addEntity(e: Entity): void };
      const mob = createMob(host.nextId++, MOBS.forest_wolf, 20, sim.groundPos(FLAT_X + 8, 0));
      mob.hostile = true;
      mob.maxHp = 10_000;
      mob.hp = 10_000;
      host.addEntity(mob);
      cast(sim, mage, mob.pos.x);
      const live = mob.auras.find((a) => a.id === 'temporal_hourglass');
      expect(live?.kind, 'the mob did not receive the incapacitate arm').toBe('incapacitate');
      expect(live?.sourceId, "the suspension is the mage's own aura").toBe(mage.id);
      for (const track of AURA_TRACKS) {
        expect(
          rowsFor(sim, mage, track.id),
          `the hostile suspension leaked into the ${track.id} track`,
        ).not.toContain(`${mob.id}:temporal_hourglass`);
      }
    }
  });

  it('covers every Chronomancy spell that leaves a trackable helpful aura', () => {
    // THE AUDIT BEHIND THIS FIX, KEPT AS A PIN. Chronomancy is the mage healer
    // spec and it had FOUR spells missing at once, every one for the same reason:
    // the content models them with a bespoke effect type that authors neither a
    // `hot`/absorb TYPE nor a `kind`, and the catalog classifies by type for
    // heals and absorbs and by kind for everything else, so an effect authoring
    // neither fell through both halves of the derivation and joined no track.
    // A whole spec's buffs were invisible and nothing was red.
    //
    // The untracked half is asserted too, with the reason each one is out. An
    // exclusion nobody can state is how the next spell goes missing quietly.
    const tracked: ReadonlyArray<readonly [string, AuraTrackCategory]> = [
      ['temporal_echo', 'hot'],
      ['temporal_hourglass', 'guard'],
      ['temporal_acceleration', 'power'],
      ['perfect_moment', 'power'],
      ['temporal_barrier', 'absorb'],
      ['mass_barrier', 'absorb'],
    ];
    for (const [id, category] of tracked) {
      expect(abilities[id], `${id} is no longer a Chronomancy ability`).toBeDefined();
      const entry = auraTrackEntry(id);
      expect(entry, `${id} leaves a helpful aura and must be tracked`).toBeDefined();
      expect(entry?.category, `${id} changed category`).toBe(category);
      if (!entry) continue;
      const homes = AURA_TRACKS.filter((t) => t.accepts(entry, true) || t.accepts(entry, false));
      expect(homes.length, `${id} is in the catalog but no track shows it`).toBeGreaterThan(0);
    }
    const untracked: ReadonlyArray<readonly [string, string]> = [
      // Its group mark IS a `temporal_echo` aura (combat/chronomancy.ts applies
      // one id for both casts), so it shares that row. A row of its own would be
      // keyed by an ability id no live aura carries, the ghost class the
      // "keys every entry by the aura id the sim applies" test exists to catch.
      ['temporal_cascade', 'its mark is a temporal_echo aura and shares that row'],
      // A direct heal leaves no aura at all.
      ['temporal_mend', 'a direct heal, no aura'],
      // Rewind restores recent damage in one shot; the resurrections put a player
      // back on their feet. None of the three leaves anything running.
      ['temporal_rewind', 'an instant restore, no aura'],
      ['temporal_reversal', 'a resurrection, no aura'],
      ['collective_reversal', 'a resurrection, no aura'],
    ];
    for (const [id, why] of untracked) {
      expect(abilities[id], `${id} is no longer a Chronomancy ability`).toBeDefined();
      expect(auraTrackEntry(id), `${id} must stay untracked: ${why}`).toBeUndefined();
    }
  });

  it('shows Temporal Cascade group marks as Friendly rows under the echo row', () => {
    // The group cast is the reason the echo effect types name their aura id
    // rather than defaulting to the ability id. Cascade marks the target plus its
    // nearest allies, and every one of those marks must reach the Friendly track
    // through the SAME catalog row the single-target cast uses.
    const friendly = AURA_TRACKS.find((t) => t.id === 'friendly');
    expect(friendly).toBeDefined();
    if (!friendly) return;
    const sim = new Sim({
      seed: 23,
      playerClass: 'mage',
      autoEquip: true,
      world: EMPTY_TEST_WORLD,
    });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('arcane'), 'mage could not pick arcane').toBe(true);
    sim.tick();
    const mage = sim.player;
    mage.resource = mage.maxResource;
    const allyIds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const id = sim.addPlayer('warrior', `Ally${i}`);
      const ally = sim.entities.get(id);
      expect(ally, 'an ally never joined the world').toBeDefined();
      if (!ally) return;
      ally.pos = { ...mage.pos };
      ally.pos.x += 1 + i * 0.4;
      ally.prevPos = { ...ally.pos };
      sim.partyInvite(id, mage.id);
      sim.partyAccept(id);
      allyIds.push(id);
    }
    sim.targetEntity(allyIds[0]);
    sim.castAbility('temporal_cascade');
    for (let i = 0; i < 60; i++) sim.tick();

    const marked = allyIds.filter((id) =>
      sim.entities
        .get(id)
        ?.auras.some((a) => a.id === 'temporal_echo' && a.sourceId === mage.id && a.echoGroup),
    );
    expect(marked.length, 'Temporal Cascade marked no group ally').toBeGreaterThan(0);
    const view = createAuraTrackView(friendly, {
      isOwn: (a) => a.sourceId === mage.id,
      isMode: () => false,
      auraName: (a) => a.name,
      unitName: (e) => e.name,
      iconKey: (a) => a.id,
    });
    const state = view.tick({
      player: mage,
      allies: sim.entities.values(),
      enabled: true,
      includeModes: true,
    });
    const rows = state.rows.slice(0, state.count).map((r) => r.key);
    for (const id of marked) {
      expect(rows, `the Cascade mark on ${id} paints no Friendly row`).toContain(
        `${id}:temporal_echo`,
      );
    }
  });

  it("paints the Chronomancy output windows, and only the caster's copy of a group burst", () => {
    // THE OTHER HALF OF THE SAME CLAIM. The tests above drive the real selection
    // core for the ally HoT and the guard; without this the two Offensive rows
    // would be asserted at the CATALOG level only, and a catalog row nothing
    // paints is the same bug wearing a green test.
    //
    // It also pins the group-burst gate. Temporal Acceleration lands an IDENTICAL
    // copy on every party member in 40 yd, all expiring on the same tick, so an
    // ally row carries nothing the caster's own row does not. Ungated, one press
    // in a raid fills the track to its cap with copies of one buff and pushes the
    // caster's real cooldowns into the overflow line. The party here is deliberately
    // large enough that an ungated core would paint several rows, so this fails
    // loudly rather than by one row.
    const power = AURA_TRACKS.find((t) => t.id === 'power');
    expect(power).toBeDefined();
    if (!power) return;
    const sim = new Sim({
      seed: 31,
      playerClass: 'mage',
      autoEquip: true,
      world: EMPTY_TEST_WORLD,
    });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('arcane'), 'mage could not pick arcane').toBe(true);
    sim.tick();
    const mage = sim.player;
    mage.resource = mage.maxResource;
    const allyIds: number[] = [];
    for (let i = 0; i < 4; i++) {
      const id = sim.addPlayer('warrior', `Ally${i}`);
      const ally = sim.entities.get(id);
      expect(ally, 'an ally never joined the world').toBeDefined();
      if (!ally) return;
      ally.pos = { ...mage.pos };
      ally.pos.x += 1 + i * 0.4;
      ally.prevPos = { ...ally.pos };
      sim.partyInvite(id, mage.id);
      sim.partyAccept(id);
      allyIds.push(id);
    }
    const cast = (id: string) => {
      mage.gcdRemaining = 0;
      mage.resource = mage.maxResource;
      sim.castAbility(id, mage.id);
      for (let i = 0; i < 3; i++) sim.tick();
    };
    cast('temporal_acceleration');
    cast('perfect_moment');

    // The auras really landed on the allies: that is what makes the absence of
    // ally ROWS below a deliberate gate rather than a cast that never went out.
    const marked = allyIds.filter((id) =>
      sim.entities
        .get(id)
        ?.auras.some((a) => a.id === 'temporal_acceleration' && a.sourceId === mage.id),
    );
    expect(marked.length, 'Temporal Acceleration reached no ally at all').toBeGreaterThan(1);

    const view = createAuraTrackView(power, {
      isOwn: (a) => a.sourceId === mage.id,
      isMode: () => false,
      auraName: (a) => a.name,
      unitName: (e) => e.name,
      iconKey: (a) => a.id,
    });
    const state = view.tick({
      player: mage,
      allies: sim.entities.values(),
      enabled: true,
      includeModes: true,
    });
    const rows = state.rows.slice(0, state.count).map((r) => r.key);
    expect(rows, 'the caster cannot see their own haste window').toContain(
      `${mage.id}:temporal_acceleration`,
    );
    expect(rows, 'Perfect Moment paints no Offensive row').toContain(`${mage.id}:perfect_moment`);
    for (const id of marked) {
      expect(rows, `an identical group-burst copy on ${id} took a row`).not.toContain(
        `${id}:temporal_acceleration`,
      );
    }
    expect(state.overflow, 'a four-ally party should not overflow the track').toBe(0);
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
