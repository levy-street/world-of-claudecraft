import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { damageEventStartsAttackAnimation } from '../src/render/characters/damage_attack_animation';
import { CharacterSurfaceResponse } from '../src/render/characters/surface_response';
import {
  meleeContactPoint,
  meleeImpactProfile,
} from '../src/render/melee_impact_core';
import { damageContact } from '../src/render/impact_contact';
import type { CharacterVisual } from '../src/render/characters/visual';

describe('anatomical contact ownership', () => {
  it('allows the earned auto hit without letting it restart the body during an authored action',()=>{
    const view={hasAttackClipOverride:()=>true,isPerformingAbility:true};
    expect(damageEventStartsAttackAnimation({kind:'player'},view,false,null)).toBe(false);
    expect(damageEventStartsAttackAnimation({kind:'player'},view,false,ABILITIES.sinister_strike.name,'sinister_strike')).toBe(true);
  });
  it('does not replay attacks on bleed ticks or their final expiry tick', () => {
    for (const id of ['garrote', 'rupture', 'hemorrhage', 'venomrend']) {
      expect(
        damageEventStartsAttackAnimation(
          { kind: 'player' },
          null,
          false,
          ABILITIES[id].name,
        ),
      ).toBe(false);
      expect(
        damageEventStartsAttackAnimation(
          { kind: 'player' },
          null,
          false,
          ABILITIES[id].name,
          id,
        ),
      ).toBe(true);
    }
    expect(
      damageEventStartsAttackAnimation(
        { kind: 'player' },
        null,
        false,
        ABILITIES.bloodthirst.name,
      ),
    ).toBe(true);
    expect(
      damageEventStartsAttackAnimation({ kind: 'player' }, null, false, null),
    ).toBe(true);
  });
  it('gives periodic damage a wound without another flinch hold', () => {
    const visual = { respondToElement: vi.fn(), holdFrame: vi.fn() };
    damageContact(
      visual as unknown as CharacterVisual,
      { school: 'physical', amount: 20, ability: ABILITIES.garrote.name },
      true,
      false,
    );
    expect(visual.respondToElement.mock.calls[0][0]).toBe('physical-blood');
    expect(visual.holdFrame).not.toHaveBeenCalled();
  });
  it('keeps blood contact attached to a translating and turning target then clears before the GCD', () => {
    const response = new CharacterSurfaceResponse(),
      root = new THREE.Group();
    root.position.set(4, 1, 8);
    root.rotation.y = Math.PI / 2;
    root.updateMatrixWorld(true);
    response.trigger('physical-blood', 0.9, meleeImpactProfile('garrote'));
    response.update(0.08, root, 2);
    expect(response.uniforms.uSurfaceOrigin.value.toArray()).toEqual([4, 1, 8]);
    expect(response.uniforms.uSurfaceRight.value.y).toBeCloseTo(-1);
    expect(response.uniforms.uSurfaceContact.value.x).toBe(0.74);
    root.position.x = 9;
    root.updateMatrixWorld(true);
    response.update(0.06, root, 2);
    expect(response.uniforms.uSurfaceOrigin.value.x).toBe(9);
    response.update(0.1, root, 2);
    expect(response.active).toBe(false);
  });
  it('keeps edge, crush, piercing, and ragged cuts topologically distinct and finite', () => {
    const paths = [];
    for (const id of [
      'heroic_strike',
      'shield_slam',
      'mongoose_bite',
      'sinister_strike',
    ]) {
      const profile = meleeImpactProfile(id)!,
        points = [];
      for (let i = 0; i < 12; i++) {
        const p = { x: 0, y: 0, z: 0 };
        meleeContactPoint(profile, i / 11, 0, 0, p);
        points.push(p);
      }
      expect(points.every((p) => Object.values(p).every(Number.isFinite))).toBe(
        true,
      );
      expect(points[0]).not.toEqual(points[11]);
      paths.push(JSON.stringify(points));
    }
    expect(new Set(paths).size).toBe(4);
  });
});
