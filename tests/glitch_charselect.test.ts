import { describe, expect, it } from 'vitest';
import {
  GLITCH_CHAR_ACTION,
  GLITCH_CHAR_STEP_KEY,
  type GlitchExistingCharacter,
  glitchCharselectAction,
} from '../src/net/glitch_charselect';

const base: GlitchExistingCharacter = {
  class: 'warrior',
  skin: 0,
  name: 'Glitchy',
  level: 1,
  online: false,
  forceRename: false,
};

const act = (
  existing: Partial<GlitchExistingCharacter>,
  chosen: { class?: string; skin?: number; name?: string },
  nameValid = true,
) =>
  glitchCharselectAction({
    existing: { ...base, ...existing },
    chosen: {
      class: (chosen.class ?? base.class) as GlitchExistingCharacter['class'],
      skin: chosen.skin ?? base.skin,
      name: chosen.name ?? base.name,
    },
    nameValid,
  });

describe('glitchCharselectAction', () => {
  it('enters the existing character when nothing changed', () => {
    expect(act({}, {})).toEqual({
      kind: 'enter',
      needsConfirm: false,
      takeover: false,
      reason: null,
    });
  });

  it('blocks on an empty name before anything else', () => {
    expect(act({}, { name: '   ' })).toEqual({
      kind: 'blocked',
      needsConfirm: false,
      takeover: false,
      reason: 'name_required',
    });
  });

  it('blocks on an invalid name when the Glitch name changes', () => {
    expect(act({}, { name: 'x' }, false).reason).toBe('name_invalid');
  });

  it('allows an unchanged legacy Glitch name to enter even when it fails public name validation', () => {
    expect(act({ name: 'Dev Player42' }, { name: 'Dev Player42' }, false)).toEqual({
      kind: 'enter',
      needsConfirm: false,
      takeover: false,
      reason: null,
    });
  });

  it('allows an unchanged numeric Glitch name to re-roll class or appearance', () => {
    expect(act({ name: 'Glitch400' }, { name: 'Glitch400', class: 'mage' }, false)).toMatchObject({
      kind: 'reroll',
      reason: null,
    });
    expect(
      act({ name: 'Glitch400', skin: 0 }, { name: 'Glitch400', skin: 2 }, false),
    ).toMatchObject({
      kind: 'reroll',
      reason: null,
    });
  });

  it('re-rolls (destructive) when only the name changed on a normal character', () => {
    expect(act({ level: 1 }, { name: 'NewName' })).toMatchObject({
      kind: 'reroll',
      needsConfirm: false,
    });
    expect(act({ level: 7 }, { name: 'NewName' })).toMatchObject({
      kind: 'reroll',
      needsConfirm: true,
    });
  });

  it('re-rolls without confirm when class changes on a level-1 character', () => {
    expect(act({ level: 1 }, { class: 'mage' })).toMatchObject({
      kind: 'reroll',
      needsConfirm: false,
    });
  });

  it('re-rolls WITH confirm when class changes on a leveled character', () => {
    expect(act({ level: 12 }, { class: 'mage' })).toMatchObject({
      kind: 'reroll',
      needsConfirm: true,
    });
  });

  it('treats an appearance (skin) change as a re-roll', () => {
    expect(act({ level: 5, skin: 0 }, { skin: 2 })).toMatchObject({
      kind: 'reroll',
      needsConfirm: true,
    });
  });

  it('flags takeover when the existing character is online elsewhere', () => {
    expect(act({ online: true }, {})).toMatchObject({ kind: 'enter', takeover: true });
    expect(act({ online: true, level: 9 }, { class: 'rogue' })).toMatchObject({
      kind: 'reroll',
      takeover: true,
      needsConfirm: true,
    });
  });

  it('renames non-destructively only while a forced rename is pending', () => {
    expect(act({ forceRename: true }, { name: 'Glitchy' }).reason).toBe('rename_required');
    expect(act({ forceRename: true }, { name: 'Glitchier' })).toMatchObject({ kind: 'rename' });
  });

  it('exposes stable behavioral-event keys', () => {
    expect(GLITCH_CHAR_STEP_KEY).toBe('character_create');
    expect(GLITCH_CHAR_ACTION.reroll).toBe('reroll');
    expect(GLITCH_CHAR_ACTION.selectAppearance).toBe('select_appearance');
  });
});
