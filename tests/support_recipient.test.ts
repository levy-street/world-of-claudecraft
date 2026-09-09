import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { syncRigMatrixFreeze } from '../src/render/rig_visibility_freeze';
import { type SupportAura, supportRecipientBits } from '../src/render/support_recipient_core';
import {
  SupportRecipientVisual,
  syncSupportRecipient,
} from '../src/render/support_recipient_visual';

const rune: SupportAura = {
  id: 'rune_of_power',
  kind: 'buff_dmg_done',
  remaining: 1,
  value: 0.1,
  sourceId: 8,
};
const ward: SupportAura = {
  id: 'aegis_first_dawn_dr:8',
  kind: 'shield_wall',
  remaining: 0.15,
  value: 0.5,
  sourceId: 8,
};
const speed: SupportAura = {
  id: 'aegis_first_dawn_speed',
  kind: 'buff_speed',
  remaining: 4,
  value: 1.3,
  sourceId: 8,
};

describe('actual support benefit presentation', () => {
  it('requires exact actual buff identity, source and live lifetime; pets can receive Rune only', () => {
    expect(supportRecipientBits([], false, 'player')).toBe(0);
    expect(supportRecipientBits([rune, ward, speed], false, 'player')).toBe(7);
    expect(supportRecipientBits([rune, ward, speed], true, 'player')).toBe(0);
    expect(supportRecipientBits([rune, ward, speed], false, 'mob')).toBe(1);
    for (const aura of [
      { ...ward, sourceId: 9 },
      { ...ward, id: 'shield_wall' },
      { ...ward, remaining: 0 },
      { ...ward, value: 0 },
      { ...rune, kind: 'buff_speed' },
      { ...speed, value: 1 },
    ])
      expect(supportRecipientBits([aura], false, 'player')).toBe(0);
    // Losing one provider must not clear protection from a second real source.
    expect(
      supportRecipientBits(
        [{ ...ward, id: 'aegis_first_dawn_dr:9', sourceId: 9 }],
        false,
        'player',
      ),
    ).toBe(2);
  });

  it('follows moving recipient bones and retires immediately on aura removal', () => {
    const group = new THREE.Group(),
      rig = new THREE.Group();
    group.add(rig);
    const elbow = new THREE.Bone(),
      hand = new THREE.Bone();
    elbow.name = 'lowerarml';
    hand.name = 'handl';
    elbow.position.set(0.3, 1, 0);
    hand.position.set(0.3, 0.7, 0);
    rig.add(elbow, hand);
    const view = {
      group,
      height: 1.8,
      supportRecipientVisual: null as SupportRecipientVisual | null,
    };
    const entity = { kind: 'player', dead: false, auras: [rune, ward] };
    syncSupportRecipient(view, entity, rig, null);
    const fx = view.supportRecipientVisual!;
    const before = new THREE.Matrix4(),
      after = new THREE.Matrix4();
    fx.conduits.getMatrixAt(0, before);
    syncRigMatrixFreeze(group, false);
    elbow.position.x += 2;
    syncSupportRecipient(view, entity, rig, null);
    fx.conduits.getMatrixAt(0, after);
    expect(after.elements[12] - before.elements[12]).toBeCloseTo(2);
    entity.auras = [speed];
    syncSupportRecipient(view, entity, rig, null);
    expect(fx.wards.visible).toBe(false);
    expect(fx.conduits.visible).toBe(false);
    expect(fx.feathers.visible).toBe(true);
    entity.auras = [];
    syncSupportRecipient(view, entity, rig, null);
    expect(fx.group.visible).toBe(false);
    fx.dispose();
  });

  it('retains shared geometry and retries failed owned cleanup without reviving disposed visuals', () => {
    const fx = new SupportRecipientVisual();
    const next = new SupportRecipientVisual();
    const shared = vi.spyOn(fx.conduits.geometry, 'dispose');
    const disposal = vi.spyOn(fx.wards.material, 'dispose').mockImplementationOnce(() => {
      throw new Error('driver failure');
    });
    expect(() => fx.dispose()).toThrow(AggregateError);
    fx.update(7, 1.8, null);
    expect(fx.group.visible).toBe(false);
    expect(() => fx.dispose()).not.toThrow();
    expect(disposal).toHaveBeenCalledTimes(2);
    expect(shared).not.toHaveBeenCalled();
    next.update(7, 1.8, null);
    expect(next.group.visible).toBe(true);
    next.dispose();
    shared.mockRestore();
    disposal.mockRestore();
  });
});
