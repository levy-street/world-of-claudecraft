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
    // v31 refactored the swim rise to an eased swimBlend (0..1) scaling an
    // accumulated swimBobTime; Object.create skips the field initializers, so
    // seed both. swimBlend = 1 isolates the surface pin from the eased entry,
    // and swimBobTime = -dt lands the bob on phase 0 after update()'s += dt.
    state.swimBlend = 1;
    state.swimBobTime = -0.1;
    // v0.32 added a ledge-climb pose that also feeds poseWrap; seed it inactive
    // so its contribution is 0 (Object.create skips these field initializers).
    state.climbOn = false;
    state.climbBlend = 0;
    state.climbPhase = 0;
    state.climbTarget = null;
    // The v0.32 zero-weight watchdog scans the mixer each update; Object.create
    // skips its field initializers, so seed the scan scratch and debounce (the
    // empty actions map means the repair path stays off, by design).
    state.weightScan = [];
    state.starvedFrames = 0;
    state.model = model;
    state.weaponAuraMeshes = [aura];
    state.pendingDt = 0;

    // Swimming: the pose is pinned at the surface rise (SWIM_RISE = 0.05) and
    // both hands are busy, so the held weapon and aura are hidden.
    visual.update(0.1, idleState(true), false);
    expect((state.poseWrap as THREE.Group).position.y).toBeCloseTo(0.05);
    expect(weapon.visible).toBe(false);
    expect(aura.visible).toBe(false);

    // Leaving the water restores the held props on the swim edge (first frame);
    // the surface pin then eases back to rest as swimBlend releases toward 0.
    visual.update(0.1, idleState(false), false);
    expect(weapon.visible).toBe(true);
    expect(aura.visible).toBe(true);
    for (let i = 0; i < 40; i++) visual.update(0.1, idleState(false), false);
    expect((state.poseWrap as THREE.Group).position.y).toBeCloseTo(0);
  });
});
