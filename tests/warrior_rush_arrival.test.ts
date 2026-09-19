import { expect, it } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import { applyDisplayedAnimMotion } from '../src/render/characters/anim_state_entity_core';
import { damageEventStartsAttackAnimation } from '../src/render/characters/damage_attack_animation';
import { WarriorRushPose } from '../src/render/characters/warrior_rush_pose';

const still = { moving: false, speed: 0 } as AnimState;
const rush = { moving: true, speed: 21, running: true } as AnimState;
function travelling() {
  const pose = new WarriorRushPose();
  pose.begin('charge');
  pose.update(0.1, rush);
  return pose;
}

it('retains the Onrush handoff across an automatic hit before the arrival notification', () => {
  const pose = travelling();
  pose.update(0.05, still);
  expect(pose.active).toBe(false);
  const view = {
    hasAttackClipOverride: () => false,
    get isPerformingAbility() {
      return pose.ownsBody;
    },
  };
  expect(damageEventStartsAttackAnimation({ kind: 'player' }, view, false, null)).toBe(false);
  pose.arrive();
  pose.update(0.01, still);
  expect(pose.arrivalStarted).toBe(true);
  expect(pose.recovering).toBe(true);
  pose.update(0.29, still);
  expect(pose.recovering).toBe(true);
  pose.update(0.02, still);
  expect(pose.ownsBody).toBe(false);
  expect(damageEventStartsAttackAnimation({ kind: 'player' }, view, false, null)).toBe(true);
  pose.arrive();
  pose.update(0.01, still);
  expect(pose.arrivalStarted).toBe(false);
});

it('waits for the displayed stop and never plants feet under continuing normal movement', () => {
  const pose = travelling();
  pose.arrive();
  pose.update(0.03, rush);
  expect(pose.arrivalStarted).toBe(false);
  pose.update(0.03, { ...rush, speed: 7 });
  expect(pose.ownsBody).toBe(false);
  pose.update(0.03, still);
  expect(pose.arrivalStarted).toBe(false);
});

it.each([0.01, 0.2, 0.25])(
  'a stopped %ss frame starts arrival despite the locomotion hold',
  (dt) => {
    const pose = travelling();
    pose.arrive();
    pose.update(dt, { ...rush, rawMoving: false });
    expect(pose.arrivalStarted).toBe(true);
    expect(pose.recovering).toBe(true);
    pose.update(0.03, { ...rush, rawMoving: false });
    expect(pose.recovering).toBe(true);
    pose.update(0.01, { ...rush, speed: 7, rawMoving: true });
    expect(pose.ownsBody).toBe(false);
  },
);

it('an anchor-only zero-time sync does not consume the queued arrival', () => {
  const pose = travelling();
  pose.arrive();
  pose.update(0, { ...rush, rawMoving: false });
  expect(pose.arrivalStarted).toBe(false);
  pose.update(0.01, { ...rush, rawMoving: false });
  expect(pose.arrivalStarted).toBe(true);
  pose.update(0, { ...rush, rawMoving: true });
  expect(pose.recovering).toBe(true);
});

it('reused animation scratch never carries another entity raw movement through a zero-time sync', () => {
  const scratch = {} as AnimState;
  const gait = { speed: 21, moving: true, running: true, backwards: false };
  applyDisplayedAnimMotion(scratch, gait, 1.05, 0, 0.05);
  expect(scratch.rawMoving).toBe(true);
  applyDisplayedAnimMotion(scratch, gait, 0, 0, 0);
  expect(scratch.rawMoving).toBeUndefined();
  const pose = travelling();
  pose.arrive();
  pose.update(0.01, { ...rush, rawMoving: false });
  pose.update(0, scratch);
  expect(pose.recovering).toBe(true);
  applyDisplayedAnimMotion(scratch, gait, 0, 0, 0.016);
  expect(scratch.rawMoving).toBe(false);
  pose.update(0.016, scratch);
  expect(pose.recovering).toBe(true);
});

it('never fabricates arrival from stopped, timed-out, unstarted or escort travel', () => {
  for (const kind of ['charge', 'intervene'] as const) {
    const pose = new WarriorRushPose();
    pose.begin(kind);
    pose.update(0.1, rush);
    if (kind === 'intervene') pose.arrive();
    pose.update(0.2, still);
    expect(pose.arrivalStarted).toBe(false);
    expect(pose.recovering).toBe(false);
    pose.arrive();
    pose.update(0.01, still);
    expect(pose.arrivalStarted).toBe(false);
  }
  const pose = new WarriorRushPose();
  pose.arrive();
  pose.update(0.01, still);
  expect(pose.recovering).toBe(false);
});

it.each(['dead', 'airborne', 'swimming', 'casting', 'moving'] as const)(
  'immediately yields an active arrival brace to %s',
  (key) => {
    const pose = travelling();
    pose.arrive();
    pose.update(0.01, still);
    pose.update(0.01, { ...still, [key]: true });
    expect(pose.ownsBody).toBe(false);
    expect(pose.recovering).toBe(false);
    pose.arrive();
    pose.update(0.01, still);
    expect(pose.arrivalStarted).toBe(false);
  },
);

it('a new explicit ability can cancel queued and playing arrival ownership', () => {
  for (const playing of [false, true]) {
    const pose = travelling();
    pose.arrive();
    if (playing) pose.update(0.01, still);
    pose.cancel();
    pose.update(0.01, still);
    expect(pose.ownsBody).toBe(false);
    expect(pose.arrivalStarted).toBe(false);
  }
});
