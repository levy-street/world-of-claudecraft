// The paired suite for server/character_save_fixups.ts: the session fixups
// every DURABLE character blob must carry, whichever serialization instant
// produced it (the autosave thunk, or the marketplace escrow persist's in-job
// snapshot). The module exists because a raw sim.serializeCharacter is not a
// save-shaped blob: it holds the spectator body instead of the real one, drops
// the pet the spectate stowed, and, for a jailed player, carries neither the
// jail flag nor a jail position. That last one is a moderation escape, not
// cosmetics: the sentence would be gone at the next load.
//
// Unit-tested directly rather than through GameServer, so each arm is decidable
// on its own and the jail-spawn thunk's call count is observable.

import { describe, expect, it, vi } from 'vitest';
import { applyCharacterSaveFixups } from '../server/character_save_fixups';
import type { ClientSession } from '../server/game';
import type { CharacterState, PetState } from '../src/sim/sim';

type FixupSession = Pick<ClientSession, 'spectating' | 'jailVisit' | 'jailed'>;

const JAIL_SPAWN = { x: -12_000, z: -11_975 };

const PET: PetState = {
  templateId: 'wolf',
  name: 'Fang',
  level: 12,
  hp: 340,
  dead: false,
};

/** A blob as the sim serialized it: alive, standing wherever the live body is,
 *  carrying whatever pet the live session has. Only the fields the fixups read
 *  or write matter here, so the rest of CharacterState stays off the fixture. */
function blob(over: Partial<CharacterState> = {}): CharacterState {
  return {
    hp: 250,
    pos: { x: 10, z: 20 },
    facing: 1.5,
    pet: null,
    dead: false,
    ghost: false,
    corpsePos: null,
    ...over,
  } as unknown as CharacterState;
}

/** A session holding none of the three states; each case switches on the one
 *  it is about, so no arm can pass by inheriting another's fixture. */
function session(over: Partial<FixupSession> = {}): FixupSession {
  return { spectating: null, jailVisit: null, jailed: null, ...over };
}

const spectating = (stowedPet: PetState | null): FixupSession['spectating'] => ({
  characterId: 21,
  name: 'Watcher',
  savedPos: { x: 111, y: 42, z: 222 },
  priorGm: false,
  stowedPet,
});

describe('a spectating session persists the real body, not the spectator one', () => {
  it('writes the saved position and hands the stowed pet back to the blob', () => {
    // The live body is off at whatever the moderator is watching, so the blob
    // must take the position the spectate saved. The pet is the same story
    // told about a different field: spectating stows it, so a blob written
    // from the live session would persist "no pet" and lose it for good.
    const s = blob({ pos: { x: 9999, z: -9999 }, pet: null });
    const out = applyCharacterSaveFixups(session({ spectating: spectating(PET) }), s, () => {
      throw new Error('jailSpawn must not be consulted for an unjailed session');
    });
    expect(out.pos).toEqual({ x: 111, z: 222 });
    expect(out.pet).toEqual(PET);
    // The saved position is 3D and the blob's is not: a y that leaked through
    // would be a shape change on every spectated save.
    expect(Object.keys(out.pos).sort()).toEqual(['x', 'z']);
    // Deliberately asymmetric with the jail visit below: a spectate records no
    // facing, so the serialized one stands rather than being zeroed.
    expect(out.facing).toBe(1.5);
  });

  it('carries a null stowed pet through rather than keeping the live one', () => {
    // The pet always comes FROM the session record. A spectate that stowed
    // nothing must not let a stale blob pet survive, or a dismissed pet would
    // resurrect on the next load.
    const out = applyCharacterSaveFixups(
      session({ spectating: spectating(null) }),
      blob({ pet: PET }),
      () => JAIL_SPAWN,
    );
    expect(out.pet).toBeNull();
  });
});

describe('a jail VISIT persists the visitor position, facing and stowed pet', () => {
  it('restores all three from the visit record', () => {
    // The moderator's own trip to the cage: the same shape as spectating, plus
    // the facing, which the visit teleport also overwrote.
    const out = applyCharacterSaveFixups(
      session({
        jailVisit: {
          savedPos: { x: -5, y: 3, z: 7 },
          savedFacing: 2.25,
          priorGm: true,
          stowedPet: PET,
        },
      }),
      blob({ pos: { x: -12_000, z: -12_000 }, facing: 0, pet: null }),
      () => JAIL_SPAWN,
    );
    expect(out.pos).toEqual({ x: -5, z: 7 });
    // Same 3D-narrowing pin as the spectating arm: savedPos.y must not leak
    // into the 2D blob position.
    expect(Object.keys(out.pos).sort()).toEqual(['x', 'z']);
    expect(out.facing).toBe(2.25);
    expect(out.pet).toEqual(PET);
  });

  it('wins the position over a spectate saved on the same session', () => {
    // The middle rung of the precedence order (jail > jailVisit > spectate):
    // a moderator who visits the cage while also spectating persists the
    // VISIT record, facing included.
    const out = applyCharacterSaveFixups(
      session({
        jailVisit: {
          savedPos: { x: -5, y: 3, z: 7 },
          savedFacing: 2.25,
          priorGm: true,
          stowedPet: PET,
        },
        spectating: {
          characterId: 9,
          name: 'Watched',
          savedPos: { x: 111, y: 0, z: 222 },
          priorGm: false,
          stowedPet: null,
        },
      }),
      blob({ pos: { x: -12_000, z: -12_000 }, facing: 0, pet: null }),
      () => JAIL_SPAWN,
    );
    expect(out.pos).toEqual({ x: -5, z: 7 });
    expect(out.facing).toBe(2.25);
  });
});

describe('a jailed session persists the sentence, wherever the body was', () => {
  const JAILED = { returnPos: { x: 30, z: 40 }, returnFacing: 0.75, until: 1_800_000_000_000 };

  it('stamps the jail state and the jail spawn onto the blob', () => {
    // Without this the sentence simply ends at the next load: the blob would
    // carry no jail record and a position outside the cage, so the character
    // reloads free. That is a moderation escape, which is why the fixups are
    // mandatory on every durable write rather than an autosave nicety.
    const jailSpawn = vi.fn(() => JAIL_SPAWN);
    const out = applyCharacterSaveFixups(session({ jailed: JAILED }), blob(), jailSpawn);
    expect(out.jail).toEqual(JAILED);
    expect(out.pos).toEqual(JAIL_SPAWN);
    expect(jailSpawn).toHaveBeenCalledTimes(1);
  });

  it('lands the prisoner alive in the cage, corpse forgotten', () => {
    // A jailed character reloads standing in the cage, never as a ghost run
    // back to a corpse outside it: the death loop would otherwise be a way out.
    const out = applyCharacterSaveFixups(
      session({ jailed: JAILED }),
      blob({ dead: true, ghost: true, corpsePos: { x: 1, z: 2 }, hp: 0 }),
      () => JAIL_SPAWN,
    );
    expect(out.dead).toBe(false);
    expect(out.ghost).toBe(false);
    expect(out.corpsePos).toBeNull();
    expect(out.hp).toBe(1);
  });

  it('never heals a living prisoner up to the floor', () => {
    // The hp floor is a floor, not a set: a jailed player at 250 stays at 250.
    const out = applyCharacterSaveFixups(session({ jailed: JAILED }), blob({ hp: 250 }), () => ({
      x: 0,
      z: 0,
    }));
    expect(out.hp).toBe(250);
  });

  it('wins the position over a spectate or a visit saved on the same session', () => {
    // Order inside the module is load-bearing: the jail arm runs last, so a
    // session that is somehow both jailed and spectating persists INSIDE the
    // cage. The reverse order would write the free position and release them.
    const out = applyCharacterSaveFixups(
      session({ jailed: JAILED, spectating: spectating(PET), jailVisit: null }),
      blob(),
      () => JAIL_SPAWN,
    );
    expect(out.pos).toEqual(JAIL_SPAWN);
    expect(out.jail).toEqual(JAILED);
    // The pet still rides: the spectate arm's own work is kept, only its
    // position is overwritten.
    expect(out.pet).toEqual(PET);
  });
});

describe('an unjailed session', () => {
  it('leaves an ordinary blob exactly as the sim serialized it', () => {
    const s = blob({ pos: { x: 10, z: 20 }, facing: 1.5, pet: PET, hp: 250 });
    const jailSpawn = vi.fn(() => JAIL_SPAWN);
    const out = applyCharacterSaveFixups(session(), s, jailSpawn);
    expect(out.pos).toEqual({ x: 10, z: 20 });
    expect(out.facing).toBe(1.5);
    expect(out.pet).toEqual(PET);
    expect(out.hp).toBe(250);
    expect(out.dead).toBe(false);
    // A blob with no jail to write must not pay for the jail spawn lookup.
    expect(jailSpawn).not.toHaveBeenCalled();
  });

  it('STRIPS a stale jail flag, which is how a release becomes durable', () => {
    // The else arm, and the only thing that ends a sentence: /unjail clears
    // the session field, and the next save has to delete the key rather than
    // leave the blob claiming a jail the moderator lifted. Deleted, not set to
    // undefined: the blob is JSONB, and an explicit undefined would round-trip
    // as a missing key anyway, so absence is the shape to pin.
    const out = applyCharacterSaveFixups(
      session(),
      blob({ jail: { returnPos: { x: 30, z: 40 }, returnFacing: 0.75 } }),
      () => JAIL_SPAWN,
    );
    expect('jail' in out).toBe(false);
  });
});

describe('the fixups mutate the caller-owned blob in place', () => {
  it('returns the same object the caller passed, already fixed up', () => {
    // Both call sites (saveCharacter and serializeCharacterForPersist) treat
    // the return as the blob they hand to the durable write; a copy here would
    // mean the escrow persist wrote the UNFIXED original.
    const s = blob();
    const out = applyCharacterSaveFixups(
      session({ jailed: { returnPos: { x: 1, z: 2 }, returnFacing: 0 } }),
      s,
      () => JAIL_SPAWN,
    );
    expect(out).toBe(s);
    expect(s.pos).toEqual(JAIL_SPAWN);
  });
});
