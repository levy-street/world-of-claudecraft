// Regression test for the online/offline `stealthed` parity bug: the online
// ClientWorld mirror entity is constructed with `stealthed: false` and never
// updates it (see src/net/online.ts), since it is a server-local
// interest-filtering cache never encoded on the wire (see server/game.ts). The
// auras ARE mirrored, so hud.ts must derive `stealthed` from the aura list
// rather than trust the raw entity field. This pins that derivation directly so
// the parity cannot silently drift again; the action_bar_view tests pass
// `stealthed` straight through and cannot catch this class of bug.

import { describe, expect, it } from 'vitest';
import { playerStealthed } from '../src/ui/player_stealthed';

describe('playerStealthed', () => {
  it('is true for an online-shaped entity: a kind:"stealth" aura present despite a stale stealthed:false field', () => {
    // The mirrored aura list is the only thing playerStealthed reads; it never
    // looks at a `stealthed` field at all, so this input models exactly the
    // ClientWorld mirror shape the bug came from.
    const auras = [{ kind: 'stealth' }];
    expect(playerStealthed(auras)).toBe(true);
  });

  it('is false when no stealth aura is present', () => {
    expect(playerStealthed([])).toBe(false);
    expect(playerStealthed([{ kind: 'regen' }, { kind: 'form_bear' }])).toBe(false);
  });

  it('is true among unrelated auras (order independent)', () => {
    const auras = [{ kind: 'regen' }, { kind: 'stealth' }, { kind: 'form_cat' }];
    expect(playerStealthed(auras)).toBe(true);
  });
});
