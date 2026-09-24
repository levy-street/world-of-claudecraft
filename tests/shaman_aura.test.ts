import { describe, expect, it, vi } from 'vitest';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { isShamanAuraEvent } from '../src/render/ability_vfx/shaman_aura_core';
import { SET_PROC_FX_BY_NAME } from '../src/render/set_proc_fx';
import type { SimEvent } from '../src/sim/types';

const bank = {
  id: 'shaman_thunder_charges',
  name: 'Thunder Charges',
  kind: 'internal_cd',
  sourceId: 7,
};
const gained = {
  type: 'aura',
  targetId: 7,
  name: bank.name,
  gained: true,
  auraKind: 'internal_cd',
} satisfies Extract<SimEvent, { type: 'aura' }>;
const recipient = { id: 7, auras: [bank] };

describe('Shaman aura presentation ownership', () => {
  it('claims an exact live bank and its canonical refresh event', () => {
    expect(isShamanAuraEvent(gained, recipient)).toBe(true);
    expect(isShamanAuraEvent({ ...gained, abilityId: bank.id, sourceId: 7 }, recipient)).toBe(true);
  });

  it('recognizes stable attribution after a same-tick aura consumption without guessing a name', () => {
    expect(isShamanAuraEvent({ ...gained, abilityId: bank.id }, { id: 7, auras: [] })).toBe(true);
    expect(isShamanAuraEvent({ ...gained, abilityId: 'not_a_shaman_aura' }, recipient)).toBe(false);
  });

  it('requires exact recipient, name, supplied source and kind for legacy events', () => {
    expect(isShamanAuraEvent(gained)).toBe(false);
    expect(isShamanAuraEvent(gained, { ...recipient, id: 9 })).toBe(false);
    expect(isShamanAuraEvent({ ...gained, name: 'Thunder Charge' }, recipient)).toBe(false);
    expect(isShamanAuraEvent({ ...gained, sourceId: 9 }, recipient)).toBe(false);
    expect(isShamanAuraEvent({ ...gained, auraKind: 'hot' }, recipient)).toBe(false);
    expect(isShamanAuraEvent({ ...gained, gained: false, abilityId: bank.id }, recipient)).toBe(
      false,
    );
  });

  it('claims actual healing recipients and group buffs without requiring a Shaman wearer', () => {
    for (const aura of [
      { id: 'shaman_mending_current', name: 'Mending Current', kind: 'hot', sourceId: 7 },
      { id: 'bloodlust', name: 'Storm Chorus', kind: 'buff_haste', sourceId: 7 },
    ]) {
      expect(
        isShamanAuraEvent(
          { targetId: 11, name: aura.name, gained: true, sourceId: 7 },
          { id: 11, auras: [aura] },
        ),
      ).toBe(true);
    }
  });

  it('owns both Chorus buffs and only their same-source exhaustion companion', () => {
    const haste = { id: 'bloodlust', name: 'Storm Chorus', kind: 'buff_haste', sourceId: 7 };
    const spell = { ...haste, id: 'bloodlust_spell', kind: 'buff_spellhaste' };
    const exhaustion = { id: 'sated', name: 'Temporal Exhaustion', kind: 'sated', sourceId: 7 };
    const actual = { id: 11, auras: [haste, spell, exhaustion] };
    for (const aura of actual.auras) {
      const event = {
        targetId: 11,
        name: aura.name,
        gained: true,
        sourceId: 7,
        auraKind: aura.kind,
      };
      expect(isShamanAuraEvent(event, actual)).toBe(true);
      expect(isShamanAuraEvent({ ...event, abilityId: aura.id }, actual)).toBe(true);
    }
    const event = {
      targetId: 11,
      name: exhaustion.name,
      gained: true,
      abilityId: 'sated',
      sourceId: 7,
    };
    expect(isShamanAuraEvent(event, { id: 11, auras: [exhaustion] })).toBe(false);
    expect(
      isShamanAuraEvent(event, { id: 11, auras: [exhaustion, { ...haste, sourceId: 9 }] }),
    ).toBe(false);
    expect(isShamanAuraEvent(event, { id: 12, auras: actual.auras })).toBe(false);
  });

  it('does not confuse an unrelated same-name aura with Shaman state in either snapshot order', () => {
    const unrelated = { ...bank, id: 'set_thunder_charge' };
    for (const auras of [
      [bank, unrelated],
      [unrelated, bank],
    ]) {
      expect(isShamanAuraEvent(gained, { id: 7, auras })).toBe(false);
      expect(isShamanAuraEvent({ ...gained, abilityId: unrelated.id }, { id: 7, auras })).toBe(
        false,
      );
    }
    expect(
      isShamanAuraEvent(gained, { id: 7, auras: [{ ...bank, id: 'shaman_future_unknown' }] }),
    ).toBe(false);
  });

  it.each([
    ['earthbind_root', 'root'],
    ['earthbind_slow', 'slow'],
  ])('owns the real Gripping Earth %s on a player recipient', (id, kind) => {
    const aura = { id, kind, name: 'Gripping Earth', sourceId: 7 };
    expect(
      isShamanAuraEvent(
        { targetId: 11, name: aura.name, gained: true, auraKind: kind },
        { id: 11, auras: [aura] },
      ),
    ).toBe(true);
    expect(
      isShamanAuraEvent(
        { targetId: 11, name: aura.name, gained: true, auraKind: kind },
        { id: 11, auras: [{ ...aura, id: 'frost_nova' }] },
      ),
    ).toBe(false);
  });

  it('preserves unrelated buffs and all existing themed set-proc events', () => {
    const names = [...SET_PROC_FX_BY_NAME.keys()];
    expect(names.length).toBeGreaterThan(0);
    for (const name of ['Arcane Intellect', 'Ward of Faith', ...names]) {
      expect(isShamanAuraEvent({ ...gained, name }, recipient)).toBe(false);
    }
    expect(isShamanAuraEvent({ ...gained, abilityId: 'arcane_intellect' }, recipient)).toBe(false);
  });

  it('suppresses the separate painter gain-swirl path only for authored Shaman abilities', () => {
    const buffSwirl = vi.fn();
    const painter = Object.create(AbilityVfx.prototype) as AbilityVfx;
    Object.assign(painter, { deps: { vfx: { buffSwirl } }, quality: 'high' });
    for (const ability of [
      'lightning_shield',
      'elemental_mastery',
      'flametongue_weapon',
      'bloodlust',
    ])
      painter.onAuraGained({ targetId: 7, gained: true, ability });
    expect(buffSwirl).not.toHaveBeenCalled();
    painter.onAuraGained({ targetId: 7, gained: true, ability: 'arcane_intellect' });
    expect(buffSwirl).toHaveBeenCalledOnce();
    expect(buffSwirl.mock.calls[0][0]).toBe(7);
  });
});
