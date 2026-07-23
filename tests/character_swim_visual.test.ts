import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import { CharacterVisual } from '../src/render/characters/visual';

const idleState = (swimming: boolean): AnimState => ({
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  channeling: false,
  swimming,
  sitting: false,
});

describe('CharacterVisual swimming presentation', () => {
  it('uses the surface-height pin and hides/restores held props across the swim edge', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const model = new THREE.Group();
    const weapon = new THREE.Mesh();
    weapon.userData.weaponMesh = true;
    model.add(weapon);
    const aura = new THREE.Mesh();

    const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
    const state = visual as unknown as Record<string, unknown>;
    state.hitCooldown = 0;
    state.stow = { attached: false, target: false, timer: 0 };
    state.wasDead = false;
    state.deadLock = false;
    state.initialized = true;
    state.baseState = 'idle';
    state.current = null;
    state.currentIsOneShot = false;
    state.currentOneShotIsEmote = false;
    state.def = { clips: { idle: 'Idle', attack: [] } };
    state.actions = new Map();
    state.spinAngle = 0;
    state.spinOnceTimer = 0;
    state.poseWrap = new THREE.Group();
    state.swimPitch = 0;
    state.bobPhase = 0;
    state.swimHidingWeapons = false;
    state.model = model;
    state.weaponAuraMeshes = [aura];
    state.pendingDt = 0;

    visual.update(0.1, idleState(true), false);
    expect((state.poseWrap as THREE.Group).position.y).toBeCloseTo(0.05);
    expect(weapon.visible).toBe(false);
    expect(aura.visible).toBe(false);

    visual.update(0.1, idleState(false), false);
    expect((state.poseWrap as THREE.Group).position.y).toBe(0);
    expect(weapon.visible).toBe(true);
    expect(aura.visible).toBe(true);
  });
});
