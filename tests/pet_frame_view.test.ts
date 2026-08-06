import { describe, expect, it } from 'vitest';
import {
  DELVE_COMPANION_TEMPLATE_IDS,
  findOwnPet,
  type PetFrameUnit,
  petFrameDescriptorInto,
} from '../src/ui/pet_frame_view';
import type { UnitFrameDescriptor } from '../src/ui/unit_frame';

const PLAYER_ID = 7;
// Taken from the real content table rather than hard-coded, so this tracks a rename.
const COMPANION_TEMPLATE = [...DELVE_COMPANION_TEMPLATE_IDS][0];

function unit(over: Partial<PetFrameUnit> = {}): PetFrameUnit {
  return {
    id: 100,
    kind: 'mob',
    ownerId: PLAYER_ID,
    templateId: 'wolf',
    name: 'Fang',
    hp: 300,
    maxHp: 400,
    dead: false,
    ...over,
  };
}

function blankDescriptor(): UnitFrameDescriptor {
  return {
    present: false,
    hpFrac: 0,
    hpText: '',
    resourceKind: 'none',
    resFrac: 0,
    resText: '',
    levelText: null,
    name: '',
    portraitKey: '',
    absorb: null,
    dead: false,
    outOfRange: false,
  };
}

describe('findOwnPet', () => {
  it('finds the mob owned by the player', () => {
    const pet = unit();
    const found = findOwnPet([unit({ id: 1, ownerId: null }), pet], PLAYER_ID);
    expect(found).toBe(pet);
  });

  it('ignores a mob owned by a DIFFERENT player', () => {
    const found = findOwnPet([unit({ id: 2, ownerId: PLAYER_ID + 1 })], PLAYER_ID);
    expect(found).toBeNull();
  });

  it('ignores a wild mob with no owner', () => {
    expect(findOwnPet([unit({ ownerId: null })], PLAYER_ID)).toBeNull();
  });

  it('ignores a non-mob entity even when its ownerId matches', () => {
    expect(findOwnPet([unit({ kind: 'player' })], PLAYER_ID)).toBeNull();
  });

  it('returns a DEAD pet, so the frame and the revive action keep showing it', () => {
    const corpse = unit({ dead: true, hp: 0 });
    expect(findOwnPet([corpse], PLAYER_ID)).toBe(corpse);
  });

  it('returns null on an empty roster', () => {
    expect(findOwnPet([], PLAYER_ID)).toBeNull();
  });

  // A delve companion carries the player's ownerId too, so ownership alone cannot
  // tell it from a pet. The sim's own petOf excludes companions; so must this, or a
  // hunter in a delve (whose real pet is stowed for the run) gets the companion's
  // health under a frame labelled as their pet.
  it('skips a delve companion and keeps looking', () => {
    const realPet = unit({ id: 5, templateId: 'wolf' });
    const found = findOwnPet([unit({ id: 4, templateId: COMPANION_TEMPLATE }), realPet], PLAYER_ID);
    expect(found).toBe(realPet);
  });

  it('returns null when a delve companion is the ONLY owned mob', () => {
    expect(findOwnPet([unit({ templateId: COMPANION_TEMPLATE })], PLAYER_ID)).toBeNull();
  });

  it('knows at least one companion template, so the exclusion is not vacuous', () => {
    expect(DELVE_COMPANION_TEMPLATE_IDS.size).toBeGreaterThan(0);
  });

  // The core is consumed by both worlds through IWorld's shared entity roster. Sim
  // holds real Entity records and ClientWorld rebuilds them from wire fields, so the
  // same roster is driven here in each shape to pin that neither drifts.
  it('resolves identically for a Sim-shaped and a ClientWorld-shaped roster', () => {
    const simShaped = unit({ id: 11, name: 'Fang' });
    // ClientWorld decodes ownerId from the wire `own` field and defaults the pet
    // fields it does not receive; the shape the core reads is the same.
    const wireShaped = {
      ...unit({ id: 11, name: 'Fang' }),
      petMode: 'defensive',
      petTauntTimer: 0,
    };
    expect(findOwnPet([simShaped], PLAYER_ID)?.id).toBe(findOwnPet([wireShaped], PLAYER_ID)?.id);
    const a = petFrameDescriptorInto(blankDescriptor(), simShaped, 'Dead');
    const b = petFrameDescriptorInto(blankDescriptor(), wireShaped, 'Dead');
    expect({ ...a }).toEqual({ ...b });
  });
});

describe('petFrameDescriptorInto', () => {
  it('marks the frame absent when the player has no pet', () => {
    const d = blankDescriptor();
    d.present = true;
    expect(petFrameDescriptorInto(d, null, 'Dead').present).toBe(false);
  });

  it('derives hp fraction, hp text, and name for a live pet', () => {
    const d = petFrameDescriptorInto(blankDescriptor(), unit(), 'Dead');
    expect(d.present).toBe(true);
    expect(d.hpFrac).toBeCloseTo(0.75);
    expect(d.hpText).toBe('300 / 400');
    expect(d.name).toBe('Fang');
    expect(d.dead).toBe(false);
    expect(d.portraitKey).toBe('100');
  });

  it('uses the localized dead text and sets the dead flag for a corpse', () => {
    const d = petFrameDescriptorInto(blankDescriptor(), unit({ dead: true, hp: 0 }), 'Tot');
    expect(d.hpText).toBe('Tot');
    expect(d.dead).toBe(true);
    expect(d.hpFrac).toBe(0);
  });

  it('always reports no resource bar: pets carry no power type', () => {
    const d = petFrameDescriptorInto(blankDescriptor(), unit(), 'Dead');
    expect(d.resourceKind).toBe('none');
    expect(d.resFrac).toBe(0);
    expect(d.resText).toBe('');
  });

  it('leaves the level chip blank and carries no shield overlay', () => {
    const d = petFrameDescriptorInto(blankDescriptor(), unit(), 'Dead');
    expect(d.levelText).toBeNull();
    expect(d.absorb).toBeNull();
    expect(d.showAbsorbText).toBe(false);
  });

  it('guards against a zero maxHp instead of dividing by zero', () => {
    const d = petFrameDescriptorInto(blankDescriptor(), unit({ hp: 0, maxHp: 0 }), 'Dead');
    expect(Number.isFinite(d.hpFrac)).toBe(true);
    expect(d.hpFrac).toBe(0);
  });

  it('reuses the caller-owned descriptor rather than allocating one', () => {
    const d = blankDescriptor();
    expect(petFrameDescriptorInto(d, unit(), 'Dead')).toBe(d);
    expect(petFrameDescriptorInto(d, null, 'Dead')).toBe(d);
  });

  it('is same-input-same-output across repeated derivations', () => {
    const pet = unit();
    const a = { ...petFrameDescriptorInto(blankDescriptor(), pet, 'Dead') };
    const b = { ...petFrameDescriptorInto(blankDescriptor(), pet, 'Dead') };
    expect(a).toEqual(b);
  });
});
