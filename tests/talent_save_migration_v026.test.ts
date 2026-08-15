import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import { type CharacterState, Sim } from '../src/sim/sim';
import {
  CURRENT_CHARACTER_CONTENT_REVISION,
  migrateCharacterTalentsV2,
} from '../src/sim/talent_save_migration';
import { ALL_CLASSES } from '../src/sim/types';

const fixtureUrl = new URL('./fixtures/v025_warrior_character.json', import.meta.url);
const fixtureBytes = readFileSync(fixtureUrl);
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as {
  provenance: Record<string, string>;
  state: CharacterState;
};

function cloneFixture(): CharacterState {
  return structuredClone(fixture.state);
}

function savedState(value: CharacterState | null): CharacterState {
  expect(value).not.toBeNull();
  if (value === null) throw new Error('character was not serialized');
  return value;
}

describe('talent production save migrations', () => {
  it('pins the representative v0.25 stable-Warrior fixture and its provenance', () => {
    expect(fixture.provenance).toEqual({
      kind: 'synthetic-production-shape',
      release: 'v0.25.0',
      class: 'warrior',
      note: 'Pinned representative stable-Warrior JSONB save; contains no account or player PII.',
    });
    // Re-pinned: the fixture's active questLog ids became the
    // real q_spiders/q_wolves because the load arm now prunes unknown active
    // quest ids (tests/quest_log_normalization.test.ts owns that contract).
    expect(createHash('sha256').update(fixtureBytes).digest('hex')).toBe(
      'dccd7e77b53c5c271e87d95ddee334384b32f6590e9602417c4b20f32f4cf637',
    );
  });

  it('preserves class-neutral state while converting the point tree to an empty canonical row repick', () => {
    const before = cloneFixture();
    const migrated = migrateCharacterTalentsV2('warrior', before);

    expect(migrated).not.toBe(before);
    // Pinned to a literal: an accidental bump re-migrates every live character.
    expect(CURRENT_CHARACTER_CONTENT_REVISION).toBe(4);
    expect(migrated.contentRevision).toBe(CURRENT_CHARACTER_CONTENT_REVISION);
    expect(migrated.talents).toEqual({ spec: 'fury', rows: {} });

    const changedKeys = new Set(['contentRevision', 'talents', 'loadouts', 'activeLoadout']);
    for (const [key, value] of Object.entries(before)) {
      if (!changedKeys.has(key))
        expect((migrated as unknown as Record<string, unknown>)[key]).toEqual(value);
    }
  });

  it('repairs legacy loadouts without guessing row choices or retaining obsolete bar entries', () => {
    const migrated = migrateCharacterTalentsV2('warrior', cloneFixture());
    expect(migrated.activeLoadout).toBe(0);
    expect(migrated.loadouts).toHaveLength(2);
    expect(migrated.loadouts?.[0].alloc).toEqual({ spec: 'fury', rows: {} });
    expect(migrated.loadouts?.[1].alloc).toEqual({ spec: null, rows: {} });

    const bar = migrated.loadouts?.[0].bar ?? [];
    expect(bar[0]).toBe('battle_shout');
    expect(bar).toContain('bloodthirst');
    expect(bar).toContain('charge');
    expect(bar).not.toContain('deleted_warrior_spell');
    expect(bar).not.toContain('enrage_passive');
    expect(bar).not.toContain('battle_stance');
    expect(bar).not.toContain('avatar');
    expect(bar.filter((id) => id === 'bloodthirst')).toHaveLength(1);
    expect(bar.filter((id): id is string => id !== null).length).toBe(
      new Set(bar.filter((id): id is string => id !== null)).size,
    );
  });

  it('preserves a valid specialization and grants a free row repick for every playable class', () => {
    for (const cls of ALL_CLASSES) {
      const spec = TALENTS[cls].specs[0].id;
      const legacy = cloneFixture() as unknown as Record<string, unknown>;
      legacy.talents = { spec, ranks: { retired: 5 }, choices: { retired: 'choice' } };
      legacy.loadouts = [];
      legacy.activeLoadout = -1;
      const migrated = migrateCharacterTalentsV2(cls, legacy as unknown as CharacterState);
      expect(migrated.talents, cls).toEqual({ spec, rows: {} });
      expect(migrated.contentRevision, cls).toBe(CURRENT_CHARACTER_CONTENT_REVISION);
    }
  });

  it('is idempotent and does not remigrate a current-revision save', () => {
    const once = migrateCharacterTalentsV2('warrior', cloneFixture());
    const twice = migrateCharacterTalentsV2('warrior', once);
    expect(twice).toBe(once);
    expect(twice).toEqual(once);
  });

  it('gives v0.28 Hunters a safe row repick and repairs retired loadout abilities', () => {
    const legacy = cloneFixture();
    legacy.contentRevision = 1;
    legacy.level = 20;
    legacy.talents = {
      spec: 'beast_mastery',
      rows: {
        5: 'hun_r5_improved_serpent_sting',
        8: 'hun_r8_frost_trap',
        11: 'hun_r11_mend_pet',
        14: 'hun_r14_multi_shot',
        17: 'hun_r17_master_tamer',
        20: 'hun_r20_aspect_of_the_wild',
      },
    };
    legacy.loadouts = [
      {
        name: 'Old Beast Mastery',
        alloc: structuredClone(legacy.talents),
        bar: ['frost_trap', 'multi_shot', 'aspect_of_the_wild'],
      },
    ];
    legacy.activeLoadout = 0;

    const migrated = migrateCharacterTalentsV2('hunter', legacy);

    expect(migrated.contentRevision).toBe(CURRENT_CHARACTER_CONTENT_REVISION);
    expect(migrated.contentRevision).toBeGreaterThan(1);
    expect(migrated.talents).toEqual({ spec: 'beast_mastery', rows: {} });
    expect(migrated.loadouts?.[0].alloc).toEqual({ spec: 'beast_mastery', rows: {} });
    expect(migrated.loadouts?.[0].bar).toContain('pack_command');
    expect(migrated.loadouts?.[0].bar).not.toContain('frost_trap');
    expect(migrated.loadouts?.[0].bar).not.toContain('multi_shot');
    expect(migrated.loadouts?.[0].bar).not.toContain('aspect_of_the_wild');
    expect(migrated.xp).toBe(legacy.xp);
    expect(migrated.copper).toBe(legacy.copper);
  });

  it('gives revision-2 Druids a free repick and removes retired row grants', () => {
    const legacy = cloneFixture();
    legacy.contentRevision = 2;
    legacy.level = 20;
    legacy.talents = {
      spec: 'feral',
      rows: {
        5: 'dru_r5_improved_wrath',
        8: 'dru_r8_typhoon',
        11: 'dru_r11_innervate',
        14: 'dru_r14_savage_fury',
        17: 'dru_r17_frenzied_regeneration',
        20: 'dru_r20_berserk',
      },
    };
    legacy.loadouts = [
      {
        name: 'Old Wildfang',
        alloc: structuredClone(legacy.talents),
        bar: ['feral_charge', 'innervate', 'frenzied_regeneration', 'berserk'],
      },
    ];
    legacy.activeLoadout = 0;

    const migrated = migrateCharacterTalentsV2('druid', legacy);

    expect(migrated.contentRevision).toBe(CURRENT_CHARACTER_CONTENT_REVISION);
    expect(migrated.contentRevision).toBeGreaterThan(2);
    expect(migrated.talents).toEqual({ spec: 'feral', rows: {} });
    expect(migrated.loadouts?.[0].alloc).toEqual({ spec: 'feral', rows: {} });
    expect(migrated.loadouts?.[0].bar).toContain('feral_charge');
    expect(migrated.loadouts?.[0].bar).not.toContain('innervate');
    expect(migrated.loadouts?.[0].bar).not.toContain('frenzied_regeneration');
    expect(migrated.loadouts?.[0].bar).not.toContain('berserk');
  });

  it('re-qualifies a revision-2 Hunter: revision 2 is ambiguous across the merged fleet', () => {
    // The class wave and the Warlock overhaul each shipped a revision 2 with a
    // DIFFERENT class set, so a stored 2 cannot be trusted to mean either one.
    // Every class redesigned anywhere in the wave therefore re-qualifies at
    // revision 4: rows wipe, spec survives, and the bar is scrubbed.
    const legacy = cloneFixture();
    legacy.contentRevision = 2;
    legacy.level = 20;
    legacy.talents = {
      spec: 'beast_mastery',
      rows: { 5: 'hun_r5_tactical_retreat', 20: 'hun_r20_overdraw' },
    };

    const migrated = migrateCharacterTalentsV2('hunter', legacy);

    expect(migrated.contentRevision).toBe(CURRENT_CHARACTER_CONTENT_REVISION);
    expect(migrated.talents).toEqual({ spec: 'beast_mastery', rows: {} });
  });

  it('scrubs a retired ability off an untouched class bar without granting a repick', () => {
    // The universal scrub is the safety net: a class NOT in the redesigned set
    // keeps its deliberate row picks, but a slot naming an ability it cannot use
    // is still dead and must go.
    const legacy = cloneFixture();
    legacy.contentRevision = 1;
    legacy.level = 20;
    legacy.talents = { spec: 'arms', rows: {} };
    legacy.loadouts = [
      {
        name: 'Arms',
        alloc: { spec: 'arms', rows: {} },
        bar: ['heroic_strike', 'judgement', null, null, null],
      },
    ];
    legacy.activeLoadout = 0;

    const migrated = migrateCharacterTalentsV2('warrior', legacy);

    expect(migrated.loadouts?.[0]?.bar).not.toContain('judgement');
  });

  it('migrates revision-1 Warlock loadout bars to the overhauled specialization kit', () => {
    const state = cloneFixture();
    state.contentRevision = 1;
    state.talents = { spec: 'destruction', rows: { 5: 'wlk_r5_bane' } };
    state.loadouts = [
      {
        name: 'Old Destruction',
        alloc: { spec: 'destruction', rows: { 5: 'wlk_r5_bane' } },
        bar: ['shadow_bolt', 'corruption', 'curse_of_agony', 'searing_pain', 'summon_doomguard'],
      },
    ];
    state.activeLoadout = 0;

    const migrated = migrateCharacterTalentsV2('warlock', state);
    const bar = migrated.loadouts?.[0].bar ?? [];

    expect(migrated.contentRevision).toBe(CURRENT_CHARACTER_CONTENT_REVISION);
    // Warlock is in REDESIGNED_AT_CURRENT_REVISION, so its rows wipe for a free
    // repick (its row ids were reused with changed meaning) while the spec
    // survives. Same contract the Druid redesign set.
    expect(migrated.talents).toEqual({ spec: 'destruction', rows: {} });
    expect(bar).toEqual(
      expect.arrayContaining([
        'shadow_bolt',
        'umbral_anchor',
        'conflagrate',
        'chaos_bolt',
        'shadowburn',
        'ruinous_brand',
        'rain_of_fire',
        'summon_infernal',
      ]),
    );
    expect(bar).not.toEqual(
      expect.arrayContaining(['corruption', 'curse_of_agony', 'searing_pain', 'summon_doomguard']),
    );
  });

  it('drops a wiped Warlock row grant off the bar rather than re-seeding it', () => {
    const state = cloneFixture();
    state.contentRevision = 1;
    state.level = 8;
    state.talents = { spec: 'affliction', rows: { 8: 'wlk_r8_voidfeast' } };
    state.loadouts = [
      {
        name: 'Old Control',
        alloc: { spec: 'affliction', rows: { 8: 'wlk_r8_voidfeast' } },
        bar: ['voidfeast'],
      },
    ];
    state.activeLoadout = 0;

    const migrated = migrateCharacterTalentsV2('warlock', state);
    const bar = migrated.loadouts?.[0].bar ?? [];

    // The row wipe means no row-granted ability can be seeded: spell_lock is
    // granted BY wlk_r8_voidfeast, which the repick just cleared. The retired
    // voidfeast id is scrubbed either way, which is the point of the pass.
    expect(bar).not.toContain('voidfeast');
    expect(bar).not.toContain('spell_lock');
    expect(migrated.talents).toEqual({ spec: 'affliction', rows: {} });
  });

  it('loads, saves, and reloads the migrated Warrior without duplicate learning or neutral-state loss', () => {
    const sim = new Sim({ seed: 17, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Migration Fixture', { state: cloneFixture() });
    const first = savedState(sim.serializeCharacter(pid));

    expect(first.contentRevision).toBe(CURRENT_CHARACTER_CONTENT_REVISION);
    expect(first.talents).toEqual({ spec: 'fury', rows: {} });
    expect(first.level).toBe(20);
    expect(first.xp).toBe(173);
    expect(first.copper).toBe(9876);
    expect(first.inventory).toEqual(fixture.state.inventory);
    expect(first.bags).toEqual(fixture.state.bags);
    expect(first.bank).toEqual(fixture.state.bank);
    expect(first.equipment).toEqual(fixture.state.equipment);
    // The fixture's active questLog ids are REAL quests (q_spiders, q_wolves):
    // the load arm prunes unknown active quest ids
    // (tests/quest_log_normalization.test.ts), while questsDone keeps its
    // synthetic q_fixture_done, pinning that done-history survives unknown ids.
    expect(first.questLog).toEqual(fixture.state.questLog);
    expect(first.questsDone).toEqual(fixture.state.questsDone);
    // Same shape one field over (#2511): the fixture's townFocus is
    // `{ eastbrook: 4 }`, a key that names no component family, and the load
    // arm drops it so it cannot ride back out through the panel into a request
    // the command boundary now rejects. Not vacuous, the fixture really does
    // carry it, and the pure migration above still preserves it verbatim: the
    // drop belongs to the load arm alone.
    expect(fixture.state.townFocus).toEqual({ eastbrook: 4 });
    expect(first.townFocus).toEqual({});
    expect(first.skin).toBe(3);
    expect(first.cooldowns).toEqual(fixture.state.cooldowns);

    const meta = sim.meta(pid);
    expect(meta).toBeDefined();
    const known = meta?.known.map((entry) => entry.def.id) ?? [];
    expect(known).toContain('bloodthirst');
    expect(new Set(known).size).toBe(known.length);
    expect(sim.events.some((event) => event.type === 'learnAbility')).toBe(false);

    const sim2 = new Sim({ seed: 17, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', 'Migration Fixture', { state: first });
    const second = savedState(sim2.serializeCharacter(pid2));
    expect(second.talents).toEqual(first.talents);
    expect(second.loadouts).toEqual(first.loadouts);
    expect(second.contentRevision).toBe(first.contentRevision);
    expect(second.inventory).toEqual(first.inventory);
    expect(second.bank).toEqual(first.bank);
  });
});
