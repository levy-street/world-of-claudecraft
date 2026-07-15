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

describe('v0.26 Talents V2 production save migration', () => {
  it('pins the representative v0.25 stable-Warrior fixture and its provenance', () => {
    expect(fixture.provenance).toEqual({
      kind: 'synthetic-production-shape',
      release: 'v0.25.0',
      class: 'warrior',
      note: 'Pinned representative stable-Warrior JSONB save; contains no account or player PII.',
    });
    expect(createHash('sha256').update(fixtureBytes).digest('hex')).toBe(
      '99847185f18fd13c110e13c6fa2e5e1c71c38a8d9fee9dcf725a62fbc7323e0b',
    );
  });

  it('preserves class-neutral state while converting the point tree to an empty canonical row repick', () => {
    const before = cloneFixture();
    const migrated = migrateCharacterTalentsV2('warrior', before);

    expect(migrated).not.toBe(before);
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
    expect(first.questLog).toEqual(fixture.state.questLog);
    expect(first.questsDone).toEqual(fixture.state.questsDone);
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
