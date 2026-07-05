import { describe, expect, it } from 'vitest';
import { charselectPrimaryAction } from '../src/net/charselect_action';

describe('charselectPrimaryAction', () => {
  it('offers a disabled Enter World placeholder when nothing is selected', () => {
    expect(charselectPrimaryAction(null)).toEqual({
      kind: 'disabled',
      labelKey: 'auth.enterWorld',
      titleKey: null,
    });
  });

  it('blocks entry with a rename-required hint while a forced rename is pending', () => {
    expect(charselectPrimaryAction({ online: false, forceRename: true })).toEqual({
      kind: 'disabled',
      labelKey: 'auth.enterWorld',
      titleKey: 'character.renameRequired',
    });
  });

  it('offers Take Over for a character online in another session', () => {
    expect(charselectPrimaryAction({ online: true, forceRename: false })).toEqual({
      kind: 'takeover',
      labelKey: 'character.takeOver',
      titleKey: null,
    });
  });

  it('offers Enter World for a ready offline character', () => {
    expect(charselectPrimaryAction({ online: false, forceRename: false })).toEqual({
      kind: 'enter',
      labelKey: 'auth.enterWorld',
      titleKey: null,
    });
  });

  it('prioritises the rename block over the online take-over state', () => {
    // forceRename wins: a character that is both online and force-rename must be
    // renamed first, so entry stays disabled rather than offering Take Over.
    expect(charselectPrimaryAction({ online: true, forceRename: true }).kind).toBe('disabled');
  });
});
